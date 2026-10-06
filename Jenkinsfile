pipeline {
  agent {
    kubernetes {
      label 'dind-agent'
    }
  }

  environment {
    // GCP Sandbox (ny-sandbox) Artifact Registry
    GCP_PROJECT = 'ny-sandbox'
    GCP_AR      = "asia-south1-docker.pkg.dev/${GCP_PROJECT}"
    IMAGE_NAME  = 'ai-interview-platform'
  }

  stages {
    stage('Initialize') {
      steps {
        script {
          env.LAST_COMMIT_HASH = sh(script: "git rev-parse HEAD", returnStdout: true).trim().substring(0,6)
        }
      }
    }

    stage('Build') {
      steps {
        sh "docker build --no-cache -t ${env.IMAGE_NAME}:staging-gcp ."
      }
    }

    stage('Push to GCP Sandbox') {
      steps {
        withCredentials([file(credentialsId: 'gcp-sa-key', variable: 'GCP_KEY_FILE')]) {
          script {
            echo "Pushing to ${env.GCP_AR}/${env.IMAGE_NAME}"

            // Login
            sh 'cat $GCP_KEY_FILE | docker login -u _json_key --password-stdin https://asia-south1-docker.pkg.dev'

            // Tag and Push
            sh "docker tag ${env.IMAGE_NAME}:staging-gcp ${env.GCP_AR}/${env.IMAGE_NAME}/${env.IMAGE_NAME}:${env.LAST_COMMIT_HASH}"
            sh "docker push ${env.GCP_AR}/${env.IMAGE_NAME}/${env.IMAGE_NAME}:${env.LAST_COMMIT_HASH}"

            // Latest tag
            sh "docker tag ${env.IMAGE_NAME}:staging-gcp ${env.GCP_AR}/${env.IMAGE_NAME}/${env.IMAGE_NAME}:latest"
            sh "docker push ${env.GCP_AR}/${env.IMAGE_NAME}/${env.IMAGE_NAME}:latest"
          }
        }
      }
    }
  }
}
