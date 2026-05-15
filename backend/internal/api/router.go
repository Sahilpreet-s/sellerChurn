package api

import (
	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
)

func SetupRouter(st *Store) *gin.Engine {
	r := gin.Default()

	r.Use(cors.New(cors.Config{
		AllowOrigins:     []string{"http://localhost:3000", "http://localhost:5173", "http://localhost:4173"},
		AllowMethods:     []string{"GET", "POST", "PUT", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Authorization"},
		AllowCredentials: true,
	}))

	v1 := r.Group("/api/v1")
	{
		v1.GET("/sellers", st.ListSellers)
		v1.GET("/sellers/:id", st.GetSeller)
		v1.POST("/sellers/:id/outcome", st.LogOutcome)
		v1.POST("/sellers/:id/guide", st.GetRetentionGuide)

		v1.POST("/audio/upload", st.UploadAudio)

		v1.GET("/patterns", st.GetPatterns)
		v1.GET("/stats", st.GetStats)

		v1.GET("/playbook", st.GetPlaybook)
		v1.POST("/playbook/rebuild", st.RebuildPlaybook)

		v1.GET("/ml/prediction/:id", st.GetMLPrediction)
		v1.GET("/ml/stats", st.GetMLStats)
		v1.POST("/ml/train", st.TriggerTraining)
	}

	return r
}
